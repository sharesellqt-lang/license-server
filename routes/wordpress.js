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

      // =========================
      // 1. ADMIN BYPASS ALL
      // =========================
      if (isAdmin) return true;

      const cats = post.categories || [];

      // =========================
      // 2. LOCKED POST (CẤM TẤT CẢ)
      // =========================
      // 👉 bạn tạo category "locked" trong WP
      if (cats.includes("locked")) return false;

      // =========================
      // 3. MAP CATEGORY → REQUIRED PLAN
      // =========================
      let required = "free";

      // ⚠️ WP category ID mapping
      // 1 = free
      // 2 = pro
      // 3 = vip
      // 999 = locked (KHÔNG phải WP mặc định, bạn tự dùng logic string OR custom id)

      if (cats.includes(3)) required = "vip";
      else if (cats.includes(2)) required = "pro";
      else if (cats.includes(1)) required = "free";

      // =========================
      // 4. CHECK PLAN RANK
      // =========================
      return rank[plan] >= rank[required];

    }

    posts = posts.filter(canView);

    res.json(posts);

  }
);