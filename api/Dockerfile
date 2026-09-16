FROM python:3.12-slim

# Pinned, wheels only: an unpinned installer makes every rebuild a different
# image, and a source distribution would run its setup scripts here.
RUN pip install --no-cache-dir --only-binary :all: uv==0.12.12

WORKDIR /app
# Named, not globbed: a glob copies whatever else the build context happens to
# carry by that shape.
COPY pyproject.toml uv.lock README.md ./
# --locked refuses a lockfile that no longer matches pyproject, instead of
# quietly resolving something newer than what CI tested.
RUN uv sync --locked --no-install-project --no-build

COPY src ./src
COPY tests ./tests
# The project itself is the one thing built from source in this image — hence
# no --no-build on this sync. The app reads its code and writes nothing outside
# /tmp, so it runs as a user of its own: root only widens what a bug can reach.
RUN uv sync --locked \
 && useradd --create-home --uid 10001 studio \
 && chown -R studio:studio /app
USER studio

ENV PATH="/app/.venv/bin:${PATH}"
EXPOSE 8000
CMD ["uvicorn", "studio_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
