output "public_subnet_id" {
  value = aws_subnet.public.id
}

output "private_subnet_id" {
  value = aws_subnet.private.id
}

output "private_subnet_2_id" {
  value = aws_subnet.private_2.id
}

output "worker_private_ip" {
  value = aws_instance.worker.private_ip
}

output "nat_gateway_id" {
  value = aws_nat_gateway.main.id
}
