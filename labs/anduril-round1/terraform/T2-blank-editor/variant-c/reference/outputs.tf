output "private_ip" {
  value = aws_instance.node.private_ip
}

output "node_security_group_id" {
  value = aws_security_group.node.id
}
