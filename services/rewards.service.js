async function loadRewardsWallet() {
    const token = localStorage.getItem("token");

    if (!token) {
        throw new Error("NOT_AUTHENTICATED");
    }

    const response = await fetch(
        `${CONFIG.API_BASE}${CONFIG.REWARDS.API}${CONFIG.REWARDS.WALLET_ENDPOINT}`,
        {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw new Error(data.error || "WALLET_LOAD_FAILED");
    }

    return data.wallet;
}