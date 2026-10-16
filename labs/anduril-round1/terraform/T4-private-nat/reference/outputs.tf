output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_id" {
  value = aws_subnet.public.id
}

output "web_security_group_id" {
  value = aws_security_group.web.id
}

output "private_subnet_id" {
  value = aws_subnet.private.id
}

output "nat_public_ip" {
  value = aws_eip.nat.public_ip
}

output "app_private_ip" {
  value = aws_instance.app.private_ip
}
