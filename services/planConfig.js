module.exports = {

  free: {

    limits: {
      scan: 5
    },

    features: []

  },

  pro: {

    limits: {
      scan: 100
    },

    features: [
      "scan"
    ]

  },

  vip: {

    limits: {
      scan: 999999
    },

    features: [
      "scan",
      "vip_scan"
    ]

  }

};