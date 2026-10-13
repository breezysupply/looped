# C02 stack — uses the bootstrap bucket as its backend with the S3 lockfile.
# terraform init -backend-config="bucket=<bootstrap output>" -backend-config="region=<region>"
terraform {
  required_version = ">= 1.10.0"
  backend "s3" {
    key          = "beacon/c02.tfstate"
    use_lockfile = true # S3-native lock object (.tflock); no DynamoDB table
    encrypt      = true
  }
  required_providers {
    random = { source = "hashicorp/random", version = "3.7.2" }
  }
}
# Something cheap with state worth protecting: no cloud resources at all.
resource "random_pet" "release" { length = 2 }
output "release_name" { value = random_pet.release.id }
