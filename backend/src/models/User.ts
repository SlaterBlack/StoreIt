import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type UserRole = 'admin' | 'user';
export type UserTheme = 'default' | 'retro';

export interface UserAttributes {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  theme: UserTheme | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type UserCreationAttributes = Optional<UserAttributes, 'id' | 'role' | 'theme'>;

export class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  public id!: string;
  public name!: string;
  public email!: string;
  public passwordHash!: string;
  public role!: UserRole;
  public theme!: UserTheme | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    passwordHash: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM('admin', 'user'),
      allowNull: false,
      defaultValue: 'user',
    },
    theme: {
      type: DataTypes.STRING(16),
      allowNull: true,
      defaultValue: null,
      validate: { isIn: [['default', 'retro']] },
    },
  },
  {
    sequelize,
    tableName: 'users',
    timestamps: true,
  },
);
