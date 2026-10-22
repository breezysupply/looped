# A map from key to subnet ID, built from the collection.
output "private_subnet_ids" {
  value = { for key, subnet in aws_subnet.private : key => subnet.id }
}
