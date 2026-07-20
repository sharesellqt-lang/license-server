"use strict";

function calculate(data = {}) {

    const current =
        Number(data.current_price || 0);

    return {

        seed_roi:

            data.seed_price

                ? current /
                  data.seed_price

                : 0,

        private_roi:

            data.private_price

                ? current /
                  data.private_price

                : 0,

        public_roi:

            data.public_price

                ? current /
                  data.public_price

                : 0

    };

}

module.exports = {

    calculate

};