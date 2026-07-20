// =========================================
// middleware/loadEntity.js
// =========================================

"use strict";

/* =========================================
   LOAD ENTITY
========================================= */

function loadEntity(options = {}) {

  const {

    service,

    method,

    param,

    assign,

    notFoundMessage,

    checkProject = false

} = options;

    if (!service) {

        throw new Error(
            "loadEntity(): service is required."
        );

    }

    if (!method) {

        throw new Error(
            "loadEntity(): method is required."
        );

    }

    if (!param) {

        throw new Error(
            "loadEntity(): param is required."
        );

    }

    if (!assign) {

        throw new Error(
            "loadEntity(): assign is required."
        );

    }

    return async (

        req,

        res,

        next

    ) => {

        try {

            const id =
                Number(
                    req.params[param]
                );

            if (

                !Number.isInteger(id) ||

                id <= 0

            ) {

                return res.status(400).json({

                    success: false,

                    message:

                        `Invalid ${param}.`

                });

            }

            const fn =
                service[method];

            if (

                typeof fn !==
                "function"

            ) {

                throw new Error(

                    `Method "${method}" does not exist.`

                );

            }

            const entity =
                await fn(id);

            if (!entity) {

                return res.status(404).json({

                    success: false,

                    message:

                        notFoundMessage ||

                        "Resource not found."

                });

            }

            /* =========================================
   PROJECT OWNERSHIP
========================================= */

if (

    checkProject &&

    req.project &&

    Number(entity.project_id) !==
    Number(req.project.id)

) {

    return res.status(404).json({

        success: false,

        message:

            notFoundMessage ||

            "Resource not found."

    });

}

            req[assign] =
                entity;

            next();

        }

        catch (err) {

            console.error(

                "[loadEntity]",

                err

            );

            return res.status(500).json({

                success: false,

                message:

                    err.message ||

                    "Load entity failed."

            });

        }

    };

}

module.exports =
    loadEntity;