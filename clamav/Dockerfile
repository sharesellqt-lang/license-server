
FROM clamav/clamav:stable

EXPOSE 3310

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=5 \
  CMD clamdscan --ping 3 || exit 1
