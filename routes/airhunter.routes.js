// routes/airhunter.routes.js

const express = require("express");

const router = express.Router();

const authMiddleware =
require("../middleware/auth");

const requirePlan =
require("../middleware/requirePlan");

const scanService =
require("../services/airhunter.scan.service");

const walletService =
require("../services/airhunter.wallet.service");

router.get(
  "/scan",
  authMiddleware,
  async (req,res)=>{

    try{

      const projects =
        await scanService.scan();

      return res.json({
        success:true,
        projects
      });

    }catch(err){

      return res.status(500).json({
        success:false,
        message:err.message
      });

    }

  }
);

router.post(
  "/wallet-check",
  authMiddleware,
  requirePlan("vip"),
  async (req,res)=>{

    try{

      const result =
        await walletService.checkWallets(
          req.body.wallets || []
        );

      return res.json({
        success:true,
        result
      });

    }catch(err){

      return res.status(500).json({
        success:false,
        message:err.message
      });

    }

  }
);

module.exports = router;