# Update sidecar: has the git checkout and the Docker CLI so the panel can
# check GitHub and rebuild itself without running compose from inside the
# container it is about to replace.
FROM alpine:3.21
RUN apk add --no-cache docker-cli docker-cli-compose docker-cli-buildx git bash
WORKDIR /repo
CMD ["sleep", "infinity"]
