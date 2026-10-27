import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export const PAY_TYPES = ['hourly', 'public-holiday', 'sick-leave', 'annual-leave', 'unpaid'] as const;
export type PayType = (typeof PAY_TYPES)[number];

export interface TaskAttributes {
  id: string;
  name: string;
  projectId: string;
  payType: PayType;
  isBillable: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type TaskCreationAttributes = Optional<TaskAttributes, 'id' | 'payType' | 'isBillable'>;

export class Task extends Model<TaskAttributes, TaskCreationAttributes> implements TaskAttributes {
  public id!: string;
  public name!: string;
  public projectId!: string;
  public payType!: PayType;
  public isBillable!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Task.init(
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
    projectId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    payType: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'hourly',
    },
    isBillable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: 'clockit_tasks',
    timestamps: true,
  },
);
