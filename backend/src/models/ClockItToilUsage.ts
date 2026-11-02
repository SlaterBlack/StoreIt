import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface ClockItToilUsageAttributes {
  id: string;
  userId: string;
  usageDate: string;
  hours: number;
  reason: string | null;
  recordedBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

type ClockItToilUsageCreationAttributes = Optional<
  ClockItToilUsageAttributes,
  'id' | 'reason'
>;

export class ClockItToilUsage
  extends Model<ClockItToilUsageAttributes, ClockItToilUsageCreationAttributes>
  implements ClockItToilUsageAttributes
{
  public id!: string;
  public userId!: string;
  public usageDate!: string;
  public hours!: number;
  public reason!: string | null;
  public recordedBy!: string;
  public user?: { id: string; name: string };
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ClockItToilUsage.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
    },
    usageDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    hours: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
      validate: { min: 0.01 },
    },
    reason: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    recordedBy: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
    },
  },
  {
    sequelize,
    tableName: 'clockit_toil_usages',
    timestamps: true,
  },
);
