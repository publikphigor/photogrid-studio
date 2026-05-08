# syntax=docker/dockerfile:1.6
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
        libmagic1 \
        libheif1 \
        libwebp7 \
        libjpeg62-turbo \
        libpng16-16 \
        libtiff6 \
        libvips42 \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libffi-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml ./
# `[vips]` extra installs the pyvips Python binding (CFFI). At runtime it loads
# the system libvips42 from the base image, so no libvips-dev needed here.
RUN pip install --upgrade pip && pip install --prefix=/install '.[vips]'

FROM base AS runtime
RUN groupadd --system app && useradd --system --gid app --home /app app
WORKDIR /app
COPY --from=build /install /usr/local
COPY photogrid ./photogrid
RUN mkdir -p /var/cache/photogrid && chown -R app:app /var/cache/photogrid /app
USER app
EXPOSE 8000
ENV CACHE_DIR=/var/cache/photogrid
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=10s \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/api/healthz', timeout=2).status == 200 else 1)"
CMD ["uvicorn", "photogrid.main:app", "--host", "0.0.0.0", "--port", "8000"]
