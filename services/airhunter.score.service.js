// services/airhunter.score.service.js

function calculateScore(project){

  let score = 0;

  score +=
  Math.min(
    project.funding || 0,
    100
  ) * 0.4;

  score +=
  Math.min(
    project.community || 0,
    100
  ) * 0.3;

  score +=
  Math.min(
    (project.investors || [])
    .length * 5,
    20
  );

  if(!project.token){

    score += 20;

  }

  return Math.round(score);

}

module.exports = {
  calculateScore
};