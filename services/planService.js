exports.getExpireDate = (days) => {

  const expire = new Date();

  expire.setDate(
    expire.getDate() + days
  );

  return expire;

};