"use strict";


function calculate(m={}){


const total =
Number(m.total_supply || 0);


const circulating =
Number(m.circulating_supply || 0);


const max =
Number(m.max_supply || 0);


const marketCap =
Number(m.market_cap || 0);


const fdv =
Number(m.fdv || 0);



let circulatingPercent=0;
let lockedPercent=0;
let inflation=0;



/*
==========================
SUPPLY AVAILABLE
==========================
*/


if(
total > 0 &&
circulating > 0
){

circulatingPercent =
(
circulating /
total
)
*100;


lockedPercent =
100 -
circulatingPercent;


}



/*
==========================
NO CIRCULATION
USE MARKET CAP FDV
==========================
*/


else if(

marketCap >0 &&
fdv>0

){


circulatingPercent =
(
marketCap /
fdv
)
*100;


lockedPercent =
100 -
circulatingPercent;


}



/*
==========================
NO DATA
==========================
*/


else {

circulatingPercent=0;

lockedPercent=0;

}



if(max>0 && circulating>0){


inflation =
(
(max-circulating)
/max
)
*100;


}



return {


circulating_percent:
Number(
circulatingPercent.toFixed(2)
),


locked_percent:
Number(
lockedPercent.toFixed(2)
),


inflation:
Number(
inflation.toFixed(2)
)


};


}



module.exports={

calculate

};