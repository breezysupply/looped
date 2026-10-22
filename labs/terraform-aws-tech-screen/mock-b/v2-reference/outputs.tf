output "public_subnet_id" {
  value = aws_subnet.public.id
}

output "private_subnet_id" {
  value = aws_subnet.private.id
}

output "worker_private_ip" {
  value = aws_instance.worker.private_ip
}

output "nat_gateway_id" {
  value = aws_nat_gateway.main.id
}

output "nat_public_ip" {
  description = "Give this to the partner for their allow-list."
  value       = aws_eip.nat.public_ip
}
