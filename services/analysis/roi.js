"use strict";


function safeDivide(a,b){

    a = Number(a);
    b = Number(b);


    if(
        !Number.isFinite(a) ||
        !Number.isFinite(b) ||
        b <= 0
    ){
        return 0;
    }


    const result =
        a / b;


    if(
        !Number.isFinite(result)
    ){
        return 0;
    }


    return result;

}



function calculate(data={}){


    const current =
        Number(
            data.current_price || 0
        );


    return {


        seed_roi:

            safeDivide(
                current,
                data.seed_price
            ),


        private_roi:

            safeDivide(
                current,
                data.private_price
            ),


        public_roi:

            safeDivide(
                current,
                data.public_price
            )


    };

}



module.exports={

    calculate

};