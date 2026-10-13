variable "env" {
  description = "Environment name; every Docker object is named looped-l12-<env>-*."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{1,11}$", var.env))
    error_message = "env must be 2-12 lower-case letters/digits, starting with a letter."
  }
}

variable "api_port" {
  description = "Host port (bound to 127.0.0.1 only) that forwards to Beacon's 8080."
  type        = number

  validation {
    condition     = var.api_port >= 18400 && var.api_port <= 18499
    error_message = "L12 uses host ports 18400-18499 only."
  }
}

variable "image" {
  description = "Base image, pinned by tag AND digest. Beacon's code is bind-mounted read-only, so no image build is needed."
  type        = string
  default     = "python:3.12.7-slim-bookworm@sha256:60d9996b6a8a3689d36db740b49f4327be3be09a21122bd02fb8895abb38b50d"
}

variable "extra_volume_labels" {
  description = "Additional labels for the data volume."
  type        = map(string)
  default     = {}
}
