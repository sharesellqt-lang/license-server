// =========================================
// middleware/loadAirdropProject.js
// =========================================

"use strict";

const projectService =
    require("../services/airdrop.project.service");

/* =========================================
   LOAD PROJECT
========================================= */

async function loadAirdropProject(
    req,
    res,
    next
) {

    try {

        const projectId =
            Number(req.params.id);

        if (

            !Number.isInteger(projectId) ||

            projectId <= 0

        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid project id."

            });

        }

        const project =

            await projectService.getProjectById(

                req.user.id,

                projectId

            );

        if (!project) {

            return res.status(404).json({

                success: false,

                message:
                    "Project not found."

            });

        }

        req.project = project;

        next();

    }

    catch (err) {

        console.error(

            "[Load Project]",

            err

        );

        return res.status(500).json({

            success: false,

            message:

                err.message ||

                "Failed to load project."

        });

    }

}

module.exports =
    loadAirdropProject;