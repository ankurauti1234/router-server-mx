import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";

@Entity({ schema: 'public', name: "users" })
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ type: "varchar", length: 128, unique: true })
  email!: string;

  @Column({ type: "varchar" })
  password_hash!: string;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;

  @CreateDateColumn({ type: "timestamptz" })
  updated_at!: Date;
}