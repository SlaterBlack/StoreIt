import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export interface ClockItToilPolicyAttributes {
  id: string;
  accrualMultiplier: number;
}

export class ClockItToilPolicy
  extends Model<ClockItToilPolicyAttributes>
  implements ClockItToilPolicyAttributes
{
  public id!: string;
  public accrualMultiplier!: number;
}

ClockItToilPolicy.init(
  {
    id: {
      type: DataTypes.STRING(32),
      primaryKey: true,
      defaultValue: 'default',
    },
    accrualMultiplier: {
      type: DataTypes.DECIMAL(8, 4),
      allowNull: false,
      defaultValue: 1,
    },
  },
  {
    sequelize,
    tableName: 'clockit_toil_policies',
    timestamps: true,
  },
);
