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

    console.log(JSON.stringify(posts[0], null, 2));

    const plan = req.user.plan;
    const isAdmin = req.user.isAdmin;

    const rank = {
      free: 0,
      pro: 1,
      vip: 2,
      admin: 999
    };

function canView(post) {

  const plan = req.user?.plan || "free";
  const isAdmin = req.user?.isAdmin || false;

  const rank = {
    free: 0,
    pro: 1,
    vip: 2,
    admin: 999
  };

  // =========================
  // 1. ADMIN BYPASS ALL
  // =========================
  if (isAdmin) return true;

  // =========================
  // 2. GET CATEGORY SLUGS
  // =========================
  const cats = post.categories_slugs || [];

  // =========================
  // 3. LOCKED POST (CHẶN TẤT CẢ)
  // =========================
  if (cats.includes("locked")) {
    return false;
  }

  // =========================
  // 4. DETERMINE REQUIRED PLAN
  // =========================
  let required = "free";

  if (cats.includes("vip")) {
    required = "vip";
  } 
  else if (cats.includes("pro")) {
    required = "pro";
  } 
  else if (cats.includes("free")) {
    required = "free";
  }

  // =========================
  // 5. CHECK PERMISSION
  // =========================
  return rank[plan] >= rank[required];
}

    posts = posts.filter(canView);

    res.json(posts);

  }
);