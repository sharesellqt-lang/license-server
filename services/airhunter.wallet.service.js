// services/airhunter.wallet.service.js

async function checkWallets(wallets){

  const result = [];

  for(const wallet of wallets){

    result.push({

      wallet,

      eligible:false,

      score:0,

      chains:[
        "EVM",
        "SOLANA"
      ]

    });

  }

  return result;

}

module.exports = {
  checkWallets
};