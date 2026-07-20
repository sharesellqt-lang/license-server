// =========================================
// middleware/validateId.js
// =========================================

"use strict";

/* =========================================
   VALIDATE PARAM ID
========================================= */

function validateId(...params) {

    return (req, res, next) => {

        req.ids = {};

        for (const name of params) {

            const value =
                Number(req.params[name]);

            if (

                !Number.isInteger(value) ||

                value <= 0

            ) {

                return res.status(400).json({

                    success: false,

                    message:

                        `Invalid ${name}.`

                });

            }

            req.ids[name] = value;

        }

        next();

    };

}

module.exports =
    validateId;