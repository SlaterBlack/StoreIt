import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export interface ClockItUserToilContractAttributes {
  userId: string;
  contractedHoursPerCycle: number;
}

export class ClockItUserToilContract
  extends Model<ClockItUserToilContractAttributes>
  implements ClockItUserToilContractAttributes
{
  public userId!: string;
  public contractedHoursPerCycle!: number;
}

ClockItUserToilContract.init(
  {
    userId: {
      type: DataTypes.UUID,
      primaryKey: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'CASCADE',
    },
    contractedHoursPerCycle: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
      validate: { min: 0 },
    },
  },
  {
    sequelize,
    tableName: 'clockit_user_toil_contracts',
    timestamps: true,
  },
);
