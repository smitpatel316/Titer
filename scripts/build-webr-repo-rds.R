#!/usr/bin/env Rscript
# Generate a trimmed PACKAGES.rds for the vendored webR repo, with real R.
#
# Same contract as scripts/build-webr-repo-rds.mjs (which runs R in WASM
# via webR): R's available.packages() (used by webr::install) tries
# PACKAGES.rds first and only falls back to PACKAGES.gz / PACKAGES when the
# fetch fails — so a repo without PACKAGES.rds wastes a failed fetch (and a
# warning) on every first install in a session. The upstream repo ships a
# PACKAGES.rds, but it indexes the whole repo (~20k packages); ours must
# index exactly the vendored closure, so it is generated here from the .tgz
# files themselves with tools::write_PACKAGES — the same tool R's own repos
# use — which makes it self-consistent with the tarballs by construction
# (MD5sum, File, Built, Depends/Imports/LinkingTo all read from each
# tarball's DESCRIPTION).
#
# Why this exists alongside the .mjs: webR 0.6.0 cannot initialise under
# Node on Windows — its worker loads R.js via import(path.resolve(baseUrl +
# "R.js")) and Node's ESM loader rejects a bare Windows drive-letter path
# ("Received protocol 'd:'"). No baseUrl spelling fixes it: path.resolve
# always returns a bare drive-letter path, and a file:// baseUrl breaks
# both Node's Worker constructor (ERR_WORKER_PATH: file:// URLs must be
# wrapped in `new URL`) and webR's path.resolve call. Real R has no such
# problem, so build-webr-repo.sh prefers Rscript when it is on PATH (the
# Windows CI job installs R via r-lib/actions/setup-r); everywhere else
# there is no desktop R, so the .mjs path runs instead.
#
# write_PACKAGES runs in a TEMP copy of the .tgz files (mirroring the .mjs,
# which runs it in webR's in-memory filesystem): the trimmed PACKAGES /
# PACKAGES.gz on disk stay the source of truth and are not overwritten, and
# only the generated PACKAGES.rds is copied back.
#
# Usage: Rscript scripts/build-webr-repo-rds.R [contrib-dir]
#   contrib-dir defaults to webr-repo/bin/emscripten/contrib/4.6.
# Exits non-zero (loudly) if R is not installed, no .tgz files are found,
# write_PACKAGES produces no PACKAGES.rds, or the .rds does not round-trip
# through readRDS with the same packages as the trimmed PACKAGES.

args <- commandArgs(trailingOnly = TRUE)
contrib <- if (length(args) >= 1) args[1] else "webr-repo/bin/emscripten/contrib/4.6"

tgzs <- sort(list.files(contrib, pattern = "\\.tgz$", full.names = FALSE))
if (!length(tgzs)) {
  stop("no .tgz files in ", contrib, " — run scripts/build-webr-repo.sh first")
}

tmp <- tempfile("webr-repo-rds-")
dir.create(tmp)
on.exit(unlink(tmp, recursive = TRUE), add = TRUE)
file.copy(file.path(contrib, tgzs), tmp)

cat(sprintf("generating PACKAGES.rds for %d packages in %s\n", length(tgzs), contrib))
# TAR="internal" selects R's pure-R tar reader (the .mjs sets the same:
# under webR there is no /usr/bin/tar to shell out to).
Sys.setenv(TAR = "internal")
# type="mac.binary" is the .tgz flavour: it is what makes write_PACKAGES
# look at *.tgz files (type="source" would look for *.tar.gz and find none).
tools::write_PACKAGES(tmp, type = "mac.binary")
files <- list.files(tmp)
if (!("PACKAGES.rds" %in% files)) {
  stop("tools::write_PACKAGES wrote ", paste(files, collapse = ", "), " — no PACKAGES.rds")
}

# Round-trip check in R: the .rds must read back as a character matrix
# (that is the format write_PACKAGES writes — not a data frame) listing
# exactly the vendored packages, with the same versions, MD5sums and
# files as the trimmed PACKAGES index on disk.
d <- readRDS(file.path(tmp, "PACKAGES.rds"))
p <- read.dcf(file.path(contrib, "PACKAGES"))
stopifnot(is.matrix(d), nrow(d) == length(tgzs))
stopifnot(setequal(d[, "Package"], p[, "Package"]))
stopifnot(setequal(paste(d[, "Package"], d[, "Version"]), paste(p[, "Package"], p[, "Version"])))
stopifnot(setequal(paste(d[, "Package"], d[, "MD5sum"]), paste(p[, "Package"], p[, "MD5sum"])))
stopifnot(setequal(paste(d[, "Package"], d[, "File"]), paste(p[, "Package"], p[, "File"])))
cat(sprintf("PACKAGES.rds round-trips: %d rows, %d columns\n", nrow(d), ncol(d)))
file.copy(file.path(tmp, "PACKAGES.rds"), contrib, overwrite = TRUE)
rds <- file.path(contrib, "PACKAGES.rds")
cat(sprintf("wrote %s (%.1f KB)\n", rds, file.info(rds)$size / 1024))
# Report how the generated PACKAGES compares with the trimmed index the
# build script wrote from the upstream repo — informational only, the
# trimmed index stays the source of truth and is not overwritten.
generated <- readChar(file.path(tmp, "PACKAGES"), file.info(file.path(tmp, "PACKAGES"))$size)
trimmed <- readChar(file.path(contrib, "PACKAGES"), file.info(file.path(contrib, "PACKAGES"))$size)
if (identical(generated, trimmed)) {
  cat("generated PACKAGES is byte-identical to the trimmed PACKAGES\n")
} else {
  cat(sprintf("note: generated PACKAGES differs from the trimmed PACKAGES (%d vs %d bytes) — trimmed index kept as-is\n",
              nchar(generated), nchar(trimmed)))
}
