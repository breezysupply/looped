output "public_subnet_id" {
  value = aws_subnet.public.id
}

output "private_subnet_id" {
  value = aws_subnet.private.id
}

# TODO: output "worker_private_ip" and output "nat_gateway_id"
