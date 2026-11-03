
const express = require("express");
const axios = require("axios");

const router = express.Router();

const authMiddleware = require("../middleware/auth");
const { canAccessFeature } = require("../services/feature.service");

const PYTHON_API_URL = process.env.STOCK_DATA_API_URL;
const PYTHON_API_KEY = process.env.STOCK_DATA_API_KEY;

const api = axios.create({
  baseURL: PYTHON_API_URL,
  timeout: 60000,
  headers: {
    "X-API-Key": PYTHON_API_KEY
  }
});

async function checkAccess(req, res, next) {
  try {
    const allowed = await canAccessFeature(req.user, "stockAnalysis");

    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: "Bạn cần gói PRO hoặc VIP để sử dụng Stock Analysis."
      });
    }

    next();
  } catch (error) {
    console.error("STOCK ACCESS ERROR:", error.message);

    return res.status(500).json({
      success: false,
      error: "Không thể kiểm tra quyền sử dụng Stock Analysis."
    });
  }
}

async function proxyRequest(req, res, path) {
  try {
    if (!PYTHON_API_URL || !PYTHON_API_KEY) {
      return res.status(503).json({
        success: false,
        error: "Stock Data API chưa được cấu hình."
      });
    }

    const response = await api.get(path, {
      params: req.query
    });

    return res.status(response.status).json(response.data);
  } catch (error) {
    const status = error.response?.status || 502;

    console.error("STOCK DATA API ERROR:", {
    message: error.message,
    status: error.response?.status,
    response: error.response?.data,
    path,
    target: PYTHON_API_URL,
    apiKeyExists: Boolean(PYTHON_API_KEY),
    apiKeyLength: PYTHON_API_KEY?.length || 0
});

    return res.status(status).json(
      error.response?.data || {
        success: false,
        error: "Không thể kết nối Stock Data API."
      }
    );
  }
}

// Stock information and financial statements
router.get(
  "/stock/:symbol",
  authMiddleware,
  checkAccess,
  (req, res) => {
    return proxyRequest(
      req,
      res,
      `/api/stock-data/stock/${encodeURIComponent(req.params.symbol)}`
    );
  }
);

// Historical stock prices
router.get(
  "/history/:symbol",
  authMiddleware,
  checkAccess,
  (req, res) => {
    return proxyRequest(
      req,
      res,
      `/api/stock-data/history/${encodeURIComponent(req.params.symbol)}`
    );
  }
);

// Market benchmark
router.get(
  "/benchmark",
  authMiddleware,
  checkAccess,
  (req, res) => {
    return proxyRequest(
      req,
      res,
      "/api/stock-data/benchmark"
    );
  }
);

module.exports = router;
