import mongoose from 'mongoose';

export function toObjectId(id: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(id);
}

export function toObjectIds(ids: string[]): mongoose.Types.ObjectId[] {
  return ids.map((id) => new mongoose.Types.ObjectId(id));
}
