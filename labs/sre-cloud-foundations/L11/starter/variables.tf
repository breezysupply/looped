variable "environment" {
  description = "Which Beacon environment this configuration is for. Each environment gets its own directory under out/."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "lab"], var.environment)
    error_message = "environment must be one of dev, staging, lab (lower case)."
  }
}

variable "listen_port" {
  description = "TCP port Beacon listens on inside its host or container. Beacon runs unprivileged, so ports below 1024 are refused."
  type        = number
  default     = 8080

  validation {
    condition     = var.listen_port >= 1024 && var.listen_port <= 65535 && floor(var.listen_port) == var.listen_port
    error_message = "listen_port must be a whole number from 1024 to 65535."
  }
}

variable "app_version" {
  description = "Beacon version string written into the config (MAJOR.MINOR.PATCH)."
  type        = string
  default     = "1.4.0"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+$", var.app_version))
    error_message = "app_version must look like 1.4.0."
  }
}

variable "store_kind" {
  description = "Beacon store: memory (nothing persists) or sqlite (needs store_path)."
  type        = string
  default     = "memory"

  validation {
    condition     = contains(["memory", "sqlite"], var.store_kind)
    error_message = "store_kind must be memory or sqlite (postgres arrives in the container labs)."
  }
}

variable "store_path" {
  description = "Database file for store_kind = sqlite. Ignored for memory."
  type        = string
  default     = ""
}

variable "admin_enabled" {
  description = "Expose /admin/inject and /debug/config. Only ever true in the lab environment."
  type        = bool
  default     = false

  validation {
    # A validation may refer to other variables (Terraform 1.9+).
    condition     = !var.admin_enabled || var.environment == "lab"
    error_message = "admin_enabled may only be true when environment is lab."
  }
}
