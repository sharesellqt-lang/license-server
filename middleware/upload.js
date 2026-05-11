const multer = require("multer");
const path = require("path");

// =========================
// STORAGE CONFIG
// =========================
const storage = multer.diskStorage({

  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },

  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  }

});

// =========================
// FILTER (OPTIONAL)
// =========================
const fileFilter = (req, file, cb) => {

  if (
    file.mimetype === "image/jpeg" ||
    file.mimetype === "image/png"
  ) {
    cb(null, true);
  } else {
    cb(new Error("Only images allowed"), false);
  }

};

const upload = multer({
  storage,
  fileFilter
});

module.exports = upload;