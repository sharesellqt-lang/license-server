router.get(
  "/wp-admin-posts",
  auth,
  requireAdmin,
  async (req, res) => {

    const response = await fetch(
      "https://sharesell.net/wp-json/wp/v2/posts?per_page=100"
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
      "https://sharesell.net/wp-json/wp/v2/posts?per_page=100&_embed"
    );

    let posts = await response.json();

    const plan = req.user?.plan || "free";
    const isAdmin = req.user?.isAdmin || false;

    const rank = {
      free: 0,
      pro: 1,
      vip: 2,
      admin: 999
    };

    const ADMIN_ONLY_CAT_ID = 99; // category admin-only trong WP

    posts = posts.filter(post => {

      const cats = post.categories || [];

      // =========================
      // ADMIN SEE ALL
      // =========================
      if (isAdmin) return true;

      // =========================
      // HIDE ADMIN-ONLY POSTS
      // =========================
      if (cats.includes(ADMIN_ONLY_CAT_ID)) {
        return false;
      }

      // =========================
      // PLAN FILTER
      // =========================
      let required = "free";

      if (cats.includes(3)) required = "vip";
      else if (cats.includes(2)) required = "pro";
      else if (cats.includes(1)) required = "free";

      return rank[plan] >= rank[required];

    });

    res.json(posts);

  }
);