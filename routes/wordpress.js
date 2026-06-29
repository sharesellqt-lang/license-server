router.get(
  "/wp-admin-posts",
  auth,
  requireAdmin,
  async (req, res) => {

    const response = await fetch(
      "https://YOUR-WP.com/wp-json/wp/v2/posts"
    );

    const posts = await response.json();

    res.json(posts);

  }
);

router.get(
  "/wp-posts",
  auth,
  async (req, res) => {

    const response = await fetch(
      "https://YOUR-WP.com/wp-json/wp/v2/posts"
    );

    let posts = await response.json();

    const plan = req.user.plan;

    posts = posts.filter(post => {

      const cats = post.categories || [];

      if (cats.includes("vip") && plan !== "vip") return false;
      if (cats.includes("pro") && plan === "free") return false;

      return true;

    });

    res.json(posts);

  }
);