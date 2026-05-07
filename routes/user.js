const express = require("express");

const router = express.Router();

const auth =
  require("../middleware/auth");

router.get(
  "/me",
  auth,
  async (req, res) => {

    return res.json({

      id: req.user.id,

      plan: req.user.plan,

      licensed:
        req.user.plan !== "free",

      expireAt:
        req.user.expireAt

    });

  }
);

module.exports = router;