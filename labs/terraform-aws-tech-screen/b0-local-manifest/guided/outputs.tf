# An output reads an ATTRIBUTE of a resource: <type>.<name>.<attribute>.
# terraform_data exposes whatever you put in input as .output after apply.
output "deployment_name" {
  value = terraform_data.manifest.output.name
}

# TODO: add an output named tags whose value is the tags map from
# terraform_data.manifest.output
