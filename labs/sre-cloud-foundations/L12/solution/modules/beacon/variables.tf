variable "env" {
  description = "Environment name; every Docker object is named looped-l12-<env>-*."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{1,11}$", var.env))
    error_message = "env must be 2-12 lower-case letters/digits, starting with a letter."
  }
}

variable "api_port" {
  description = "Host port (127.0.0.1 only) forwarding to Beacon's 8080."
  type        = number
}

variable "image" {
  description = "Base image pinned by tag and digest."
  type        = string
}

variable "beacon_src" {
  description = "Absolute path of labs/sre-cloud-foundations/beacon, bind-mounted read-only at /src."
  type        = string
}

variable "extra_volume_labels" {
  description = "Additional data-volume labels. Docker volume labels are immutable: changing them REPLACES the volume."
  type        = map(string)
  default     = {}
}
