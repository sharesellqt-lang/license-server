"use strict";


const axios = require("axios");


const BASE =
"https://api.coingecko.com/api/v3";



async function searchCoin(query){


if(!query){

throw new Error(
"Missing search query"
);

}


try{


const res =
await axios.get(

`${BASE}/search`,

{

params:{
query
},

timeout:10000

}

);



return (

res.data.coins || []

).map(c=>({

id:c.id,

name:c.name,

symbol:c.symbol,

market_cap_rank:
c.market_cap_rank,

thumb:c.thumb

}));


}

catch(err){


console.log(
"========== COINGECKO SEARCH ERROR =========="
);


console.log(
err.response?.status
);


console.log(
err.response?.data
);


throw err;


}


}



module.exports={

searchCoin

};