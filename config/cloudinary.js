const cloudinary = require("cloudinary").v2;

cloudinary.config({
console.log(
  process.env.CLOUDINARY_CLOUD_NAME
);
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

module.exports = cloudinary;