const fs =
require("fs");

const {
  chromium
} = require(
  "playwright"
);

const INPUT_FILE =
"links.txt";

const JSON_FILE =
"products.json";

const CSV_FILE =
"products.csv";

/* ============================
   HELPERS
============================ */

function extractProductId(
  url = ""
) {

  const match =
    url.match(
      /pdp-i(\d+)-s(\d+)/i
    );

  return {

    productId:
      match?.[1] || "",

    skuId:
      match?.[2] || ""

  };

}

function cleanTitle(
  title = ""
) {

  return title

    .replace(
      /\| Lazada\.vn$/i,
      ""
    )

    .trim();

}

function escapeCsv(
  value = ""
) {

  return `"${

    String(
      value ?? ""
    )

    .replace(
      /"/g,
      '""'
    )

  }"`;

}

/* ============================
   SCRAPER
============================ */

async function scrapeProduct(

  page,

  affiliateLink

) {

  try {

    await page.goto(

      affiliateLink,

      {

        waitUntil:
          "networkidle",

        timeout:
          60000

      }

    );

    const finalUrl =
      page.url();

    const title =

      cleanTitle(

        await page.title()

      );

    let image =
      "";

    let price =
      "";

    let currency =
      "";

    try {

      image =

        await page

          .locator(

            'meta[property="og:image"]'

          )

          .getAttribute(
            "content"
          );

    } catch {}

    const scripts =

      await page

        .locator("script")

        .allTextContents();

    const allText =

      scripts.join(
        "\n"
      );

    const rawPrice =

      allText.match(

        /"pdt_price":"([^"]+)"/

      );

    if (rawPrice) {

      price =
        rawPrice[1];

    }

    const jsonLd =

      await page

        .locator(

          'script[type="application/ld+json"]'

        )

        .allTextContents();

    for (

      const item

      of jsonLd

    ) {

      try {

        const data =
          JSON.parse(
            item
          );

        if (
          data.offers
        ) {

          price =

            data.offers.price ||

            price;

          currency =

            data.offers
              .priceCurrency ||

            "";

          break;

        }

      } catch {}

    }

    const {

      productId,

      skuId

    } =

      extractProductId(
        finalUrl
      );

    return {

      success: true,

      productId,

      skuId,

      affiliateLink,

      finalUrl,

      title,

      image,

      price,

      currency

    };

  } catch (

    error

  ) {

    return {

      success: false,

      affiliateLink,

      error:
        error.message

    };

  }

}

/* ============================
   MAIN
============================ */

(async () => {

  if (

    !fs.existsSync(
      INPUT_FILE
    )

  ) {

    console.log(
      "Missing links.txt"
    );

    process.exit(
      1
    );

  }

  const links =

    fs

      .readFileSync(

        INPUT_FILE,

        "utf8"

      )

      .split("\n")

      .map(

        x => x.trim()

      )

      .filter(
        Boolean
      );

  const browser =

    await chromium.launch({

      headless: true

    });

  const results =
    [];

  for (

    const link

    of links

  ) {

    console.log(
      link
    );

    const page =

      await browser
        .newPage();

    const result =

      await scrapeProduct(

        page,

        link

      );

    results.push(
      result
    );

    await page.close();

  }

  fs.writeFileSync(

    JSON_FILE,

    JSON.stringify(

      results,

      null,

      2

    )

  );

  const rows = [];

  rows.push(

    [

      "productId",

      "skuId",

      "title",

      "price",

      "currency",

      "image",

      "affiliateLink",

      "finalUrl"

    ].join(",")

  );

  for (

    const item

    of results

  ) {

    if (

      !item.success

    ) {

      continue;

    }

    rows.push(

      [

        escapeCsv(
          item.productId
        ),

        escapeCsv(
          item.skuId
        ),

        escapeCsv(
          item.title
        ),

        escapeCsv(
          item.price
        ),

        escapeCsv(
          item.currency
        ),

        escapeCsv(
          item.image
        ),

        escapeCsv(
          item.affiliateLink
        ),

        escapeCsv(
          item.finalUrl
        )

      ].join(",")

    );

  }

  fs.writeFileSync(

    CSV_FILE,

    rows.join(
      "\n"
    )

  );

  console.log(
    "Saved:",
    JSON_FILE
  );

  console.log(
    "Saved:",
    CSV_FILE
  );

  await browser.close();

})();