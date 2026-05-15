window.uploadBill = async function () {
  try {
    const fileInput = document.getElementById("billFile");
    if (!fileInput?.files?.length) {
      return alert("Please select a file");
    }

    if (!CURRENT_PAYMENT_ID) {
      return alert("No payment in progress");
    }

    const token = localStorage.getItem("token");
    if (!token) {
      return alert("Please login first");
    }

    const formData = new FormData();
    formData.append("bill", fileInput.files[0]);
    formData.append("paymentId", CURRENT_PAYMENT_ID);

    const res = await fetch(
      CONFIG.API_BASE + "/upload-bill",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token
        },
        body: formData
      }
    );

    const data = await res.json();

    if (!res.ok || data.error) {
      return alert(data.error || "Upload failed");
    }

    document.getElementById("billImage").src =
      URL.createObjectURL(fileInput.files[0]);

    document.getElementById("billSection").style.display =
      "block";

    updatePaymentUI("pending");

    initPaymentStream(CURRENT_PAYMENT_ID);

    alert("Bill uploaded successfully!");

  } catch (err) {
    console.error(err);
    alert("Upload failed");
  }
};