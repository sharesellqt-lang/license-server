const fs = require("fs");
const path = require("path");

// Mô tả từng file / folder
const descriptions = {
  "package-lock.json": "File khóa phiên bản các dependency (npm).",
  ".env": "File cấu hình biến môi trường (không commit).",
  "package.json": "Thông tin dự án và các dependency.",
  "admin.js": "File khởi tạo/cấu hình admin.",
  "server.js": "File chính để khởi động server.",
  "db.js": "Kết nối và cấu hình database.",
  ".gitignore": "Khai báo file/thư mục bỏ qua khi commit.",
  "README.md": "Tài liệu hướng dẫn dự án.",
  "routes": "Chứa các file định nghĩa route cho API.",
  "middleware": "Middleware xử lý request.",
  "uploads": "Thư mục lưu file upload lên server.",
  "services": "Các service xử lý nghiệp vụ.",
  "db": "Chứa file liên quan database.",
  "jobs": "Chạy các job theo lịch (cron).",
  "node_modules": "Chứa dependency cài đặt.",
  ".git": "Quản lý Git."
};

function generateTree(dir, prefix = "") {
  let items = fs.readdirSync(dir);
  let tree = "";
  items.forEach((item, index) => {
    const fullPath = path.join(dir, item);
    const isDir = fs.lstatSync(fullPath).isDirectory();
    const isLast = index === items.length - 1;
    const pointer = isLast ? "└── " : "├── ";
    const newPrefix = prefix + (isLast ? "    " : "│   ");

    if (isDir) {
      tree += `${prefix}${pointer}${item}/\n`;
      tree += generateTree(fullPath, newPrefix);
    } else {
      const desc = descriptions[item] || "";
      tree += `${prefix}${pointer}${item}  ${desc ? "# " + desc : ""}\n`;
    }
  });
  return tree;
}

const tree = generateTree("./");
fs.writeFileSync("README.md", "```\n" + tree + "```\n");
console.log("README.md đã được tạo!");