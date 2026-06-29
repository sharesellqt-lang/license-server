router.get(
  "/wp-admin-posts",
  auth,
  requireAdmin,
  async (req, res) => {

    const response = await fetch(
      "https://sharesell.net/wp-json/wp/v2/posts"
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
      "https://sharesell.net/wp-json/wp/v2/posts?per_page=100"
    );

    let posts = await response.json();

    const plan = req.user.plan;
    const isAdmin = req.user.isAdmin;

    const rank = {
      free: 0,
      pro: 1,
      vip: 2,
      admin: 999
    };

    function canView(post) {

      if (isAdmin) return true;

      const cats = post.categories || [];

      // map category → quyền
      let required = "free";

      if (cats.includes(3)) required = "vip";
      if (cats.includes(2)) required = "pro";
      if (cats.includes(1)) required = "free";

      return rank[plan] >= rank[required];
    }

    posts = posts.filter(canView);

    res.json(posts);

  }
);