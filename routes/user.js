const SHEET_NAME = "Products";

/* =====================================
GET
===================================== */

function doGet(e) {

const action =
e?.parameter?.action || "list";

switch (action) {

case "list":
  return getProducts();

default:
  return json({
    success: false,
    error: "Invalid action"
  });

}

}

/* =====================================
GET PRODUCTS
===================================== */

function getProducts() {

try {

const sheet =
  SpreadsheetApp
    .getActive()
    .getSheetByName(
      SHEET_NAME
    );

if (!sheet) {

  return json({
    success: false,
    error:
      "Sheet not found: " +
      SHEET_NAME
  });

}

const values =
  sheet
    .getDataRange()
    .getValues();

if (
  values.length <= 1
) {

  return json({
    success: true,
    total: 0,
    products: []
  });

}

const products = [];

for (
  let i = 1;
  i < values.length;
  i++
) {

  const row =
    values[i];

  const product = {

    productId:
      clean(row[0]),

    skuId:
      clean(row[1]),

    title:
      clean(row[2]),

    price:
      clean(row[3]),

    currency:
      clean(row[4]),

    image:
      clean(row[5]),

    affiliateLink:
      clean(row[6]),

    finalUrl:
      clean(row[7]),

    youtubeStatus:
      clean(row[8]),

    facebookStatus:
      clean(row[9])

  };

  if (
    !product.productId &&
    !product.title
  ) {
    continue;
  }

  products.push(
    product
  );

}

return json({

  success: true,

  total:
    products.length,

  lastUpdated:
    new Date()
      .toISOString(),

  products

});


}
catch (err) {

return json({
  success: false,
  error:
    err.message
});


}

}

/* =====================================
HELPER
===================================== */

function clean(value) {

if (
value === null ||
value === undefined
) {
return "";
}

return String(
value
).trim();

}

/* =====================================
JSON
===================================== */

function json(data) {

return ContentService
.createTextOutput(
JSON.stringify(data)
)
.setMimeType(
ContentService
.MimeType
.JSON
);

}
