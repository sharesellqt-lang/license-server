// services/airhunter.scan.service.js

const scoreService =
require("./airhunter.score.service");

async function scan(){

  const projects = [];

  projects.push({
    name:"Example Layer",
    source:"Public Feed",
    funding:80,
    community:90,
    investors:["VC1","VC2"],
    token:false,
    deadline:"2026-12-31"
  });

  projects.push({
    name:"Example Quest",
    source:"RSS",
    funding:60,
    community:70,
    investors:["VC1"],
    token:false,
    deadline:"2026-10-10"
  });

  const scored =
    projects.map(project=>({

      ...project,

      score:
      scoreService.calculateScore(
        project
      )

    }));

  return scored;

}

module.exports = {
  scan
};