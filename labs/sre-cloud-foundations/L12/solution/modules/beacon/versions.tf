terraform {
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = ">= 4.6.0, < 5.0.0" # the roots pin the exact version via their lockfiles
    }
  }
}
