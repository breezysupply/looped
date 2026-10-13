# L12 staging root. Local state only (terraform.tfstate in this directory); the
# lab guard refuses a backend block. The Docker provider talks to YOUR local
# engine through DOCKER_HOST (setup.sh sets it from `docker context` if unset).
terraform {
  required_version = ">= 1.9.0"

  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "4.6.0"
    }
  }
}

provider "docker" {}
