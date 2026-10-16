output "vpc" {
  value = aws_vpc.lab.id
}

output "subnet" {
  value = aws_subnet.edge.id
}

output "sg" {
  value = aws_security_group.edge.id
}
