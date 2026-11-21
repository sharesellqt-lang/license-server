
"use strict";

const express = require("express");
const router = express.Router();

const carouselService = require("../services/affiliate.carousel.service");

// GET /api/affiliate/carousels/:slug
// Public API: không yêu cầu đăng nhập.
router.get("/:slug", async (req, res) => {
    try {
        const slug = String(req.params.slug || "").trim();

        if (!slug) {
            return res.status(400).json({
                success: false,
                code: "INVALID_CAROUSEL_SLUG"
            });
        }

        const result = await carouselService.getPublicCarousel(slug);

        if (!result) {
            return res.status(404).json({
                success: false,
                code: "CAROUSEL_NOT_FOUND"
            });
        }

        return res.json({
            success: true,
            carousel: result
        });
    } catch (error) {
        console.error("[PUBLIC CAROUSEL ERROR]", error);

        return res.status(500).json({
            success: false,
            code: "CAROUSEL_SERVER_ERROR"
        });
    }
});

module.exports = router;
